import { z } from "zod";
import { json, tool } from "..";
import { http } from "../../http";
import type { RedisDatabase, RedisUsageResponse, UsageData } from "./types";

const readRegionSchema = z.union([
  z.literal("us-east-1"),
  z.literal("us-west-1"),
  z.literal("us-west-2"),
  z.literal("eu-west-1"),
  z.literal("eu-central-1"),
  z.literal("ap-southeast-1"),
  z.literal("ap-southeast-2"),
  z.literal("sa-east-1"),
]);

const READ_REGIONS_DESCRIPTION =
  "Available regions: us-east-1, us-west-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1, ap-southeast-2, sa-east-1";

const GENERIC_DATABASE_NOTES = "\nNOTE: Don't show the database ID from the response to the user unless explicitly asked or needed.\n";

export const redisDbOpsTools = {
  redis_database_create_new: tool({
    description: `Create a new Upstash redis database. 
NOTE: Ask user for the region and name of the database.${GENERIC_DATABASE_NOTES}`,
    inputSchema: z.object({
      name: z.string().describe("Name of the database."),
      primary_region: readRegionSchema.describe(
        `Primary Region of the Global Database. ${READ_REGIONS_DESCRIPTION}`
      ),
      read_regions: z
        .array(readRegionSchema)
        .optional()
        .describe(`Array of Read Regions of the Database. ${READ_REGIONS_DESCRIPTION}`),
    }),
    handler: async ({ name, primary_region, read_regions }) => {
      const newDb = await http.post<RedisDatabase>("v2/redis/database", {
        name,
        region: "global",
        primary_region,
        read_regions,
      });

      return [
        json(newDb),
        `Upstash console url: https://console.upstash.com/redis/${newDb.database_id}`,
      ];
    },
  }),

  redis_database_delete: tool({
    description: `Delete an Upstash redis database.`,
    inputSchema: z.object({
      database_id: z.string().describe("The ID of the database to delete."),
    }),
    handler: async ({ database_id }) => {
      await http.delete(["v2/redis/database", database_id]);

      return "Database deleted successfully.";
    },
  }),

  redis_database_list_databases: tool({
    description:
      `List all Upstash redis databases. Includes names, regions, password, creation time and more.${GENERIC_DATABASE_NOTES}`,
    handler: async () => {
      const dbs = await http.get<RedisDatabase[]>("v2/redis/databases");

      return json(
        // Only the important fields
        dbs.map((db) => ({
          database_id: db.database_id,
          database_name: db.database_name,
          database_type: db.database_type,
          region: db.region,
          type: db.type,
          primary_region: db.primary_region,
          read_regions: db.read_regions,
          creation_time: db.creation_time,
          budget: db.budget,
          state: db.state,
          password: db.password,
          endpoint: db.endpoint,
          rest_token: db.rest_token,
          read_only_rest_token: db.read_only_rest_token,
          db_acl_enabled: db.db_acl_enabled,
          db_acl_default_user_status: db.db_acl_default_user_status,
        }))
      );
    },
  }),

  redis_database_get_details: tool({
    description: `Get further details of a specific Upstash redis database. Includes all details of the database including usage statistics.
db_disk_threshold: Total disk usage limit.
db_memory_threshold: Maximum memory usage.
db_daily_bandwidth_limit: Maximum daily network bandwidth usage.
db_request_limit: Total number of commands allowed.
All sizes are in bytes
${GENERIC_DATABASE_NOTES}
      `,
    inputSchema: z.object({
      database_id: z.string().describe("The ID of the database to get details for."),
    }),
    handler: async ({ database_id }) => {
      const db = await http.get<RedisDatabase>(["v2/redis/database", database_id]);

      return json(db);
    },
  }),

  redis_database_update_regions: tool({
    description: `Update the read regions of an Upstash redis database.`,
    inputSchema: z.object({
      id: z.string().describe("The ID of your database."),
      read_regions: z
        .array(readRegionSchema)
        .describe(
          "Array of the new read regions of the database. This will replace the old regions array. Available regions: us-east-1, us-west-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1, ap-southeast-2, sa-east-1"
        ),
    }),
    handler: async ({ id, read_regions }) => {
      const updatedDb = await http.post<RedisDatabase>(["v2/redis/update-regions", id], {
        read_regions,
      });

      return json(updatedDb);
    },
  }),

  redis_database_reset_password: tool({
    description: `Reset the password of an Upstash redis database.`,
    inputSchema: z.object({
      id: z.string().describe("The ID of your database."),
    }),
    handler: async ({ id }) => {
      const updatedDb = await http.post<RedisDatabase>(["v2/redis/reset-password", id], {});

      return json(updatedDb);
    },
  }),

  redis_database_get_usage_stats: tool({
    description: `Get usage statistics of an Upstash redis database over a period of time.
Available stats: read_latency_mean, write_latency_mean, keyspace, throughput (cmds per second), daily_net_commands, diskusage, command_counts (stats of every command seperately).`,
    inputSchema: z.object({
      id: z.string().describe("The ID of your database."),
      period: z
        .union([
          z.literal("1h"),
          z.literal("3h"),
          z.literal("12h"),
          z.literal("1d"),
          z.literal("3d"),
          z.literal("7d"),
        ])
        .describe("The period of the stats."),
      type: z
        .union([
          z.literal("read_latency_mean"),
          z.literal("write_latency_mean"),
          z.literal("keyspace"),
          z.literal("throughput"),
          z.literal("daily_net_commands"),
          z.literal("diskusage"),
          z.literal("command_counts"),
        ])
        .describe("The type of stat to get"),
    }),
    handler: async ({ id, period, type }) => {
      const stats = await http.get<RedisUsageResponse>([
        "v2/redis/stats",
        `${id}?period=${period}`,
      ]);

      if (type === "command_counts") {
        return JSON.stringify(
          stats.command_counts.map((c) => ({
            command: c.metric_identifier,
            ...parseUsageData(c.data_points),
          }))
        );
      }

      const stat = stats[type];

      if (Array.isArray(stat)) {
        return JSON.stringify(parseUsageData(stat));
      }

      return json(stats);
    },
  }),
};

const parseUsageData = (data: UsageData) => {
  return {
    start: data[0].x,
    // last one can be null, so use the second last
    end: data.at(-1)?.x || data.at(-2)?.x,
    data: data.map((d) => [new Date(d.x).getTime(), d.y]),
  };
};
