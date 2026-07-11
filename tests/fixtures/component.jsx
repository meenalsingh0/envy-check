export function Banner() {
  return <div title={process.env.APP_TITLE}>{import.meta.env.VITE_GREETING}</div>;
}
