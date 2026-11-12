// Stryker disable all: Vite parses import.meta.glob itself
export const familyModules = import.meta.glob("./*/gamedb.json", {
  eager: true,
  import: "default",
});

export const languageModules = import.meta.glob("./*/*/gamedb.json", {
  eager: true,
  import: "default",
});
// Stryker restore all
