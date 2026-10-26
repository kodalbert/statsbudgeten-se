export function Credit({ menuOpen, onUpdates }: { menuOpen: boolean; onUpdates: () => void }) {
  return (
    <p className="credit" inert={menuOpen || undefined}>
      © {new Date().getFullYear()} <a href="https://proddalbert.se" target="_blank" rel="noopener">Albert (@ProddAlbert)</a> · Data från Regeringskansliet och SCB · <a href="https://github.com/kodalbert/statsbudgeten-se" target="_blank" rel="noopener">Öppen källkod</a> ·{" "}
      <a
        href="/uppdateringar"
        onClick={(e) => {
          e.preventDefault();
          onUpdates();
        }}
      >
        Uppdateringar
      </a>
    </p>
  );
}
