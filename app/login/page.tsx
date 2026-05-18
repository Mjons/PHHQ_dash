import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in — Panel Haus / Curator" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-cream p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
