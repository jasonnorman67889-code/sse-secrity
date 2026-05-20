package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

type config struct {
	APIEndpoint string
	Workstation string
	ActorID     string
	Interval    time.Duration
	KeyPath     string
	HTTPTimeout time.Duration
	Latitude    float64
	Longitude   float64
}

type eventPayload struct {
	ActorID       string         `json:"actorId"`
	Action        string         `json:"action"`
	WorkstationID string         `json:"workstationId"`
	BiometricType string         `json:"biometricType"`
	RiskScore     float64        `json:"riskScore"`
	LocationData  map[string]any `json:"locationData"`
	Timestamp     string         `json:"timestamp"`
}

type signedEventRequest struct {
	eventPayload
	Signature       string `json:"signature"`
	SignatureFormat string `json:"signatureFormat"`
	KeyID           string `json:"keyId"`
}

func main() {
	cfg := loadConfig()

	privateKey, err := loadECDSAPrivateKey(cfg.KeyPath)
	if err != nil {
		log.Fatalf("failed to load ECDSA private key: %v", err)
	}

	client := &http.Client{Timeout: cfg.HTTPTimeout}

	log.Printf("Sovereign Workstation Agent started (node=%s, interval=%s, endpoint=%s)", cfg.Workstation, cfg.Interval, cfg.APIEndpoint)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	// Send first pulse immediately on startup.
	sendPulseWithReconnect(ctx, client, cfg, privateKey)

	for {
		select {
		case <-ctx.Done():
			log.Println("agent shutdown requested")
			return
		case <-ticker.C:
			sendPulseWithReconnect(ctx, client, cfg, privateKey)
		}
	}
}

func loadConfig() config {
	cwd, _ := os.Getwd()

	endpoint := readEnvOrDefault("SOVEREIGN_API_ENDPOINT", "http://localhost:5173/api/identity-events")
	workstation := readEnvOrDefaultAny([]string{"SOVEREIGN_NODE_ID", "NODE_ID"}, "Node-LA-01")
	actor := readEnvOrDefaultAny([]string{"SOVEREIGN_ACTOR_ID", "ACTOR_ID"}, "workstation-agent")

	intervalSeconds := readEnvIntOrDefault("SOVEREIGN_SCAN_INTERVAL_SECONDS", 10)
	if intervalSeconds < 5 {
		intervalSeconds = 5
	}

	timeoutSeconds := readEnvIntOrDefault("SOVEREIGN_HTTP_TIMEOUT_SECONDS", 10)
	if timeoutSeconds < 3 {
		timeoutSeconds = 3
	}

	keyDefault := filepath.Join(cwd, "keys", "sovereign_private.pem")
	keyPath := readEnvOrDefault("SOVEREIGN_PRIVATE_KEY_PATH", keyDefault)
	latitude := readEnvFloatOrDefault("LAT", 34.0522)
	longitude := readEnvFloatOrDefault("LON", -118.2437)

	return config{
		APIEndpoint: endpoint,
		Workstation: workstation,
		ActorID:     actor,
		Interval:    time.Duration(intervalSeconds) * time.Second,
		KeyPath:     keyPath,
		HTTPTimeout: time.Duration(timeoutSeconds) * time.Second,
		Latitude:    latitude,
		Longitude:   longitude,
	}
}

func readEnvOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func readEnvOrDefaultAny(keys []string, fallback string) string {
	for _, key := range keys {
		value := os.Getenv(key)
		if value != "" {
			return value
		}
	}
	return fallback
}

func readEnvIntOrDefault(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func readEnvFloatOrDefault(key string, fallback float64) float64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func loadECDSAPrivateKey(path string) (*ecdsa.PrivateKey, error) {
	pemBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("invalid PEM for private key")
	}

	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		ecdsaKey, ok := key.(*ecdsa.PrivateKey)
		if !ok {
			return nil, errors.New("PKCS8 key is not ECDSA")
		}
		return ecdsaKey, nil
	}

	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	return nil, errors.New("unsupported private key format")
}

func sendPulseWithReconnect(ctx context.Context, client *http.Client, cfg config, privateKey *ecdsa.PrivateKey) {
	payload := eventPayload{
		ActorID:       cfg.ActorID,
		Action:        "BIOMETRIC_SUCCESS",
		WorkstationID: cfg.Workstation,
		BiometricType: "FINGERPRINT",
		RiskScore:     0.03,
		LocationData: map[string]any{
			"lat": cfg.Latitude,
			"lon": cfg.Longitude,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	signature, err := signPayload(payload, privateKey)
	if err != nil {
		log.Printf("signing failed: %v", err)
		return
	}

	requestBody := signedEventRequest{
		eventPayload:    payload,
		Signature:       signature,
		SignatureFormat: "ecdsa-p256-sha256",
		KeyID:           cfg.Workstation,
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		log.Printf("json marshal failed: %v", err)
		return
	}

	const maxAttempts = 5
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.APIEndpoint, bytes.NewReader(body))
		if err != nil {
			log.Printf("request build failed: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("send attempt %d/%d failed: %v", attempt, maxAttempts, err)
			sleepBackoff(ctx, attempt)
			continue
		}

		responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		_ = resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Printf("pulse delivered: status=%d node=%s", resp.StatusCode, cfg.Workstation)
			return
		}

		log.Printf("send attempt %d/%d returned status=%d body=%s", attempt, maxAttempts, resp.StatusCode, string(responseBody))
		sleepBackoff(ctx, attempt)
	}

	log.Printf("pulse dropped after %d failed attempts; reconnect on next interval", maxAttempts)
}

func signPayload(payload eventPayload, privateKey *ecdsa.PrivateKey) (string, error) {
	canonicalBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	digest := sha256.Sum256(canonicalBytes)
	derSignature, err := ecdsa.SignASN1(rand.Reader, privateKey, digest[:])
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(derSignature), nil
}

func sleepBackoff(ctx context.Context, attempt int) {
	maxDelay := 30 * time.Second
	delaySeconds := math.Min(math.Pow(2, float64(attempt-1)), maxDelay.Seconds())
	delay := time.Duration(delaySeconds) * time.Second

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}
