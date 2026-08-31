// The server-only marker package resolves inside the Next.js server build; the
// root program sees this ambient declaration when tests import web modules.
declare module "server-only";
