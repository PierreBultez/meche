import { describe, expect, it } from "vitest";
import { fold, fuzzyScore, matchesWordStarts, rankByQuery } from "./fuzzy";

describe("fuzzyScore", () => {
  it("matches characters in order, ignoring accents and case", () => {
    expect(fuzzyScore("epin", "Afficher les notes épinglées")).not.toBeNull();
    expect(fuzzyScore("nvnote", "Nouvelle note")).not.toBeNull();
    expect(fuzzyScore("zz", "Nouvelle note")).toBeNull();
  });

  it("prefers word starts and consecutive letters", () => {
    const words = fuzzyScore("nn", "Nouvelle note")!;
    const middle = fuzzyScore("nn", "Inconnu")!;
    expect(words).toBeGreaterThan(middle);
    expect(fuzzyScore("thème", "Thème sombre")).not.toBeNull();
    expect(fuzzyScore("thème", "Mettre la mèche")).toBeNull();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyScore("", "Réglages")).toBe(0);
  });

  it("folds accents", () => {
    expect(fold("Épinglées Réglages")).toBe("epinglees reglages");
  });
});

describe("matchesWordStarts", () => {
  it("needs every query word to start a word of the text", () => {
    expect(matchesWordStarts("nouv code", "Nouvelle note code")).toBe(true);
    expect(matchesWordStarts("theme: sombre", "Thème : sombre")).toBe(true);
    expect(matchesWordStarts("corb", "Mettre à la corbeille")).toBe(true);
    expect(matchesWordStarts("cour", "Couleur : rose")).toBe(false);
    expect(matchesWordStarts("nvnote", "Nouvelle note")).toBe(false);
  });

  it("never matches an empty query", () => {
    expect(matchesWordStarts("  ", "Réglages")).toBe(false);
  });
});

describe("rankByQuery", () => {
  const labels = ["Nouvelle note", "Nouvelle note code", "Mode concentration", "Réglages"];
  const rank = (query: string) => rankByQuery(query, labels, (label) => label);

  it("puts word-start matches first, best score first", () => {
    expect(rank("nouv code")).toEqual({ strong: ["Nouvelle note code"], weak: [] });
    expect(rank("note")).toEqual({ strong: ["Nouvelle note", "Nouvelle note code"], weak: [] });
  });

  it("keeps fuzzy matches apart and drops the rest", () => {
    expect(rank("nvnote")).toEqual({ strong: [], weak: ["Nouvelle note", "Nouvelle note code"] });
    expect(rank("zzz")).toEqual({ strong: [], weak: [] });
  });

  it("returns everything, in order, for an empty query", () => {
    expect(rank(" ")).toEqual({ strong: labels, weak: [] });
  });
});
