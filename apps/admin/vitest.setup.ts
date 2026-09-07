import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// vitest.config.ts sets test.globals: false, so @testing-library/react's
// automatic afterEach(cleanup) (which only registers when `afterEach` is a
// global) never runs. Register it explicitly so each test starts with a
// clean DOM -- without this, multiple renders in the same test file leak
// elements across tests (e.g. duplicate data-testid / role matches).
afterEach(() => {
  cleanup();
});
