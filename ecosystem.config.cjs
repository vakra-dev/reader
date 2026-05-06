/**
 * PM2 ecosystem config for reader daemon.
 *
 * Two separate instances on different ports, each with its own proxy pool.
 * NOT cluster mode: Hero browser pool is stateful (proxy-bound browsers).
 *
 * Proxy sets are split via READER_PROXIES env var in each instance's .env file.
 * Example:
 *   Instance 1 (.env.1): READER_PROXIES=dc1,dc2,dc3,dc4,dc5,res1,res2
 *   Instance 2 (.env.2): READER_PROXIES=dc6,dc7,dc8,dc9,dc10,res3,res4
 */
module.exports = {
  apps: [
    {
      name: "reader-daemon-1",
      script: "dist/cli/index.js",
      args: "start --port 6003",
      node_args: "--env-file=.env.1",
      instances: 1,
      autorestart: true,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "reader-daemon-2",
      script: "dist/cli/index.js",
      args: "start --port 6004",
      node_args: "--env-file=.env.2",
      instances: 1,
      autorestart: true,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
