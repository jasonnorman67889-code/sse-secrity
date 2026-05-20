module.exports = {
    apps: [
        {
            name: 'sovereign-sentinel',
            script: './scripts/sentinel-auto-heal.mjs',
            cwd: __dirname,
            interpreter: 'node',
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
