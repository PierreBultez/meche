import { describe, expect, it } from "vitest";
import { guessLanguage, languageFromAppData, languageFromName } from "./code-language";

describe("language of a code note", () => {
  it("reads the mode saved by the code editor of Standard Notes", () => {
    const appData = (data: object) => ({ "org.standardnotes.sn.components": { "org.standardnotes.code-editor": data } });
    expect(languageFromAppData(appData({ mode: "application/x-httpd-php" }))).toBe("php");
    expect(languageFromAppData(appData({ mode: "htmlmixed" }))).toBe("vue");
    expect(languageFromAppData(appData({ language: "Python" }))).toBe("python");
    expect(languageFromAppData(appData({ mode: "brainfuck" }))).toBeNull();
    expect(languageFromAppData(appData({}))).toBeNull();
    expect(languageFromAppData(null)).toBeNull();
    expect(languageFromAppData({ "org.standardnotes.sn.components": "x" })).toBeNull();
  });

  it("knows the names and aliases of Mèche's languages", () => {
    expect(languageFromName("ts")).toBe("typescript");
    expect(languageFromName("text/x-sql")).toBe("sql");
    expect(languageFromName(42)).toBeNull();
  });

  it.each([
    ["<?php\necho 1;", "php"],
    ['<?xml version="1.0"?>\n<a/>', "xml"],
    ["<template>\n  <div/>\n</template>", "vue"],
    ["#!/bin/bash\necho ok", "bash"],
    ["#!/usr/bin/env python3\nprint(1)", "python"],
    ['{ "a": [1, 2] }', "json"],
    ["fn main() -> i32 {\n    let mut x = 1;\n    x\n}", "rust"],
    ["SELECT id, title\nFROM notes\nWHERE pinned = 1;", "sql"],
    ["create table notes (id int);", "sql"],
    ["def bonjour(nom):\n    return nom", "python"],
    ["interface Note {\n  title: string;\n}", "typescript"],
    ["const a = 1;\nconsole.log(a);", "javascript"],
    [".carte {\n  color: red;\n}", "css"],
    ["sudo apt update\ncd /var/www", "bash"],
    ["nom: Mèche\nversion: 1\nlangues:\n  - fr", "yaml"],
    ["# Titre\n\nTexte", "markdown"],
    ["Une simple phrase, sans code.", "plaintext"],
    ["{ pas du JSON", "plaintext"],
  ])("guesses %j as %s", (code, language) => {
    expect(guessLanguage(code)).toBe(language);
  });
});
