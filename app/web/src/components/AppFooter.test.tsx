import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppFooter } from "./AppFooter";

describe("AppFooter", () => {
  it("shows legal links on the left and attribution with GitHub in the center", () => {
    render(
      <AppFooter
        copyrightLabel="2026"
        footerCurrentVersion=""
        footerUpdateUrl=""
        footerUpdateVersion=""
        showFooterCurrentVersion={false}
        showFooterUpdateNotice={false}
      />,
    );

    expect(screen.getByText("Sprinto by Martin Janeček")).toBeTruthy();
    expect(screen.getByText("© 2026")).toBeTruthy();
    expect(screen.getByText("|")).toBeTruthy();

    const githubLink = screen.getByRole("link", { name: "GitHub" });
    expect(githubLink.getAttribute("href")).toBe("https://github.com/AlienPixl/Sprinto");
    expect(githubLink.getAttribute("target")).toBe("_blank");

    const licenseLink = screen.getByRole("link", { name: "License" });
    expect(licenseLink.getAttribute("href")).toBe("https://github.com/AlienPixl/Sprinto/blob/main/LICENSE");
    expect(licenseLink.getAttribute("target")).toBe("_blank");
  });
});
