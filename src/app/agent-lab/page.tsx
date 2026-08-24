import { Badge } from "@/components/ui/badge";

export default function AgentLabPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-16">
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        Agent Lab
      </Badge>
      <h1 className="text-4xl font-bold leading-tight md:text-5xl">
        Agent Lab
      </h1>
      <p className="text-muted-foreground">
        這個頁面正在建置中，敬請期待。
      </p>
    </div>
  );
}
