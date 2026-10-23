// Browsers throw on any localStorage access when a site's cookies and site data
// are blocked, and a throw while rendering takes the whole page down ("This
// page couldn't load"). Stored values are only conveniences (dismissed
// banners), so a blocked browser just behaves as if nothing was stored.
export const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered on this browser; the current page still works.
  }
};
