import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative z-10">
        <CommandHeader />
        <main className="container py-6 space-y-6">
          <section id="database-stats">
            <DatabaseStats />
          </section>
          <div className="p-8 text-center text-primary font-mono">
            Command Center Loaded Successfully
          </div>
        </main>
      </div>
    </div>
  );
};

export default Index;
