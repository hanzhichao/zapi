/**
 * Timestamp Tag Plugin
 *
 * Usage in request URL / headers / body:
 *   {{timestamp-tag.now}}          → Unix timestamp in milliseconds, e.g. 1718000000000
 *   {{timestamp-tag.unix}}         → Unix timestamp in seconds, e.g. 1718000000
 *   {{timestamp-tag.iso}}          → ISO-8601 date string, e.g. 2024-06-10T08:00:00.000Z
 *   {{timestamp-tag.date}}         → Date only: 2024-06-10
 *   {{timestamp-tag.future(3600000)}} → now + 3,600,000 ms (1 hour from now)
 */

module.exports = {
  templateTags: [
    {
      name: "now",
      displayName: "Current Unix Timestamp (ms)",
      description: "Returns the current Unix timestamp in milliseconds.",
      args: [],
      async resolve(_args, config) {
        const offset = parseInt(config.offsetMs || "0", 10) || 0;
        return String(Date.now() + offset);
      },
    },
    {
      name: "unix",
      displayName: "Current Unix Timestamp (seconds)",
      description: "Returns the current Unix timestamp in seconds.",
      args: [],
      async resolve(_args, config) {
        const offset = parseInt(config.offsetMs || "0", 10) || 0;
        return String(Math.floor((Date.now() + offset) / 1000));
      },
    },
    {
      name: "iso",
      displayName: "Current ISO-8601 Date",
      description: "Returns the current date/time as an ISO-8601 string.",
      args: [],
      async resolve(_args, config) {
        const offset = parseInt(config.offsetMs || "0", 10) || 0;
        return new Date(Date.now() + offset).toISOString();
      },
    },
    {
      name: "date",
      displayName: "Current Date (YYYY-MM-DD)",
      description: "Returns today's date in YYYY-MM-DD format.",
      args: [],
      async resolve(_args, config) {
        const offset = parseInt(config.offsetMs || "0", 10) || 0;
        return new Date(Date.now() + offset).toISOString().slice(0, 10);
      },
    },
    {
      name: "future",
      displayName: "Future Timestamp",
      description: "Returns a Unix timestamp (ms) offset from now.",
      args: [{ name: "offsetMs", type: "number", default: "3600000" }],
      async resolve(args) {
        const extra = parseInt(args[0] || "3600000", 10) || 0;
        return String(Date.now() + extra);
      },
    },
  ],
};
