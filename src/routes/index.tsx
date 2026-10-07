import { createFileRoute } from "@tanstack/react-router";
import { KeysApp } from "@/components/keys-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <KeysApp />;
}
