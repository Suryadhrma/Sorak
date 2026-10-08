type LogFields = Record<string, unknown>;

// Objek (bukan string) supaya Workers Logs bisa memfilter per field.
export const log = {
  info(event: string, fields: LogFields = {}): void {
    console.log({ level: "info", event, ...fields });
  },
  error(event: string, fields: LogFields = {}): void {
    console.error({ level: "error", event, ...fields });
  },
};
