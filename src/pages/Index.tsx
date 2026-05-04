import { Link } from "react-router-dom";

const Index = () => (
  <main className="min-h-screen grid place-items-center p-6">
    <div className="max-w-xl text-center space-y-4">
      <h1 className="font-display text-2xl font-bold">Assessment Frontend</h1>
      <p className="text-muted-foreground">
        Open this app with phase + quiz id using <code>/quiz/:phase/:id</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        Example: <code>/quiz/pre/663440297</code> or <code>/quiz/post/663440297</code>
      </p>
      <p className="text-sm text-muted-foreground border-t border-border pt-4">
        <Link to="/assessment/from-modules" className="text-primary font-medium underline-offset-4 hover:underline">
          Build an assessment from full module-by-module content
        </Link>{" "}
        (paste Module 1, Module 2, … — same structure as generated courseware text).
      </p>
    </div>
  </main>
);

export default Index;
