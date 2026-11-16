export type GeneratorOptions = {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
};
const sets = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
};
const ambiguous = /[Il1O0o]/g;

function randomIndex(max: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}
export function generatePassword(options: GeneratorOptions) {
  const selected = (["uppercase", "lowercase", "numbers", "symbols"] as const)
    .filter((key) => options[key])
    .map((key) =>
      options.excludeAmbiguous ? sets[key].replace(ambiguous, "") : sets[key],
    );
  if (!selected.length) throw new Error("Select at least one character set");
  const required = selected.map((chars) => chars[randomIndex(chars.length)]);
  const all = selected.join("");
  const output = [...required];
  while (output.length < options.length)
    output.push(all[randomIndex(all.length)]);
  for (let i = output.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output.join("");
}
export function passwordEntropy(options: GeneratorOptions) {
  const pool = (["uppercase", "lowercase", "numbers", "symbols"] as const)
    .filter((key) => options[key])
    .reduce(
      (sum, key) =>
        sum +
        (options.excludeAmbiguous
          ? sets[key].replace(ambiguous, "").length
          : sets[key].length),
      0,
    );
  return pool ? Math.round(options.length * Math.log2(pool)) : 0;
}
