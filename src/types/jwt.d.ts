import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      storeId: string;
      email: string;
      /** JWT が古い場合は省略されうる（検証は DB の role を優先） */
      role?: string;
    };
  }
}
