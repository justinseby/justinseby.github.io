import { useEffect, useState } from "react";

// Hash-based routing (#/loans) so GitHub Pages never needs server rewrites.
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, "") || "home";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
