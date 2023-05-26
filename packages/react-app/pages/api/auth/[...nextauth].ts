import NextAuth from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";

export default NextAuth({
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_ID!,
      clientSecret: process.env.TWITTER_SECRET!,
      version: "2.0",
    })
  ],
  callbacks: {
    async jwt({ token, profile, account }) {
      if (profile) {
        token.username = profile.data.username;
      }
      return token;
    },
    async session({ session, token, user }) {
      if (token.username) {
        session.username = token.username;
      }
      return session;
    },
  },
  debug: true,
  logger: {
    error(code, metadata) {
      console.error(code, metadata);
    },
  },
});