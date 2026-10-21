export function PageHeader({ title, children, aside }: { title: string; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-rule pb-6">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {children && <div className="lede mt-3 text-[15.5px]">{children}</div>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-3">{aside}</div>}
    </header>
  );
}
