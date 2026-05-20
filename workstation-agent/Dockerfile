FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY workstation-agent/main.go ./workstation-agent/main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/sovereign-workstation-agent ./workstation-agent/main.go

FROM alpine:3.21
RUN adduser -D -H -u 10001 appuser
WORKDIR /app
COPY --from=builder /out/sovereign-workstation-agent /app/sovereign-workstation-agent
COPY keys/sovereign_private.pem /app/keys/sovereign_private.pem
USER appuser
ENV SOVEREIGN_PRIVATE_KEY_PATH=/app/keys/sovereign_private.pem
ENTRYPOINT ["/app/sovereign-workstation-agent"]