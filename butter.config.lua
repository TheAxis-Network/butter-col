-- butter-col configuration for developing this repository.
-- `npm start` runs: butter-col server start --site docs --config butter.config.lua

return {
  codec = "plain",

  transports = {
    { name = "butter" },                                  -- built in (this server)
    { name = "logged", options = { inner = "butter" } },  -- examples/transport-template
    -- Needs a Bare v3 server (e.g. bare-server-node) running somewhere:
    { name = "bare", options = { server = "http://localhost:8081/" } },
  },
  default_transport = "butter",
}
