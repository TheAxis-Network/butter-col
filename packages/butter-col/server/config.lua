-- butter-col server configuration (the package default).
-- Copy this file to butter.config.lua in your project and edit it; anything
-- left out falls back to the defaults in lua/butter/config.lua.
-- Run `butter-col server reload` after editing.

return {
  -- URL codec for proxied URLs: "none", "plain", "xor" or "base64".
  codec = "plain",

  -- Transports offered to browsers; visitors can switch between them with
  -- ButterController.setTransport(). Add more with `butter-col transport add`.
  transports = {
    { name = "butter" },                       -- built in: this server
    -- { name = "bare", options = { server = "https://bare.example.com/" } },
  },
  default_transport = "butter",

  dns = {
    nameservers = { "1.1.1.1", "8.8.8.8" },
  },

  guard = {
    -- Never set this to true on a server other people can reach: it lets
    -- visitors reach your local network and cloud metadata endpoints.
    allow_private = false,
    blocked_hosts = { "localhost", "local", "internal", "localdomain", "home.arpa" },
  },

  rate_limit = {
    enabled = true,
    requests = 1200,
    window = 60,
  },
}
