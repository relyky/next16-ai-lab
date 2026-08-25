import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home page", () => {
  it("renders the main heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1 })
    ).toHaveTextContent("用對話看懂你的財報");
  });
});
