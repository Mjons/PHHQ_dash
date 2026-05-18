import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Curator password",
      credentials: {
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds) => {
        const pw = typeof creds?.password === "string" ? creds.password : "";
        const expected = process.env.CURATOR_PASSWORD;
        if (!expected) {
          console.warn(
            "[auth] CURATOR_PASSWORD is not set — refusing all logins",
          );
          return null;
        }
        if (pw !== expected) return null;
        return {
          id: "curator",
          email: process.env.CURATOR_EMAIL || "curator@local",
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
});
