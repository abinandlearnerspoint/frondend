const Index = () => (
  <main className="min-h-screen grid place-items-center p-6">
    <div className="max-w-xl text-center space-y-3">
      <h1 className="font-display text-2xl font-bold">Assessment Frontend</h1>
      <p className="text-muted-foreground">
        Open this app with phase + quiz id using <code>/quiz/:phase/:id</code>.
      </p>
      <p className="text-sm text-muted-foreground">
        Example: <code>/quiz/pre/663440297</code> or <code>/quiz/post/663440297</code>
      </p>
    </div>
  </main>
);

export default Index;
