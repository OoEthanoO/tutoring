import pkg from "../../package.json";

type PackageJson = {
  iteration?: string | number;
};

export const iteration = String(
  (pkg as PackageJson).iteration ?? "1"
);
