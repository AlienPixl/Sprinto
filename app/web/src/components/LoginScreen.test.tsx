import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";

describe("LoginScreen", () => {
  it("renders the Microsoft button below the password sign-in action with an OR divider when password auth is available", () => {
    render(
      <LoginScreen
        authError=""
        loginMethod="username"
        onMicrosoftEntraSignIn={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        showPasswordForm
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("OR")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.queryByText("Use your company Microsoft account. Any required MFA stays managed by Microsoft Entra.")).toBeNull();
  });

  it("shows Microsoft Entra sign-in and hides the password form behind the recovery link when requested", () => {
    render(
      <LoginScreen
        authError=""
        defaultPasswordFormHidden
        loginMethod="username"
        onMicrosoftEntraSignIn={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        showPasswordForm
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use recovery account" }));
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("renders the auth error returned from the Microsoft Entra callback", () => {
    render(
      <LoginScreen
        authError="Microsoft Entra sign-in failed."
        loginMethod="username"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        showPasswordForm
      />,
    );

    expect(screen.getByText("Microsoft Entra sign-in failed.")).toBeTruthy();
  });

  it("shows a Microsoft CTA when username/password login is blocked by Entra migration enforcement", async () => {
    render(
      <LoginScreen
        authError=""
        loginMethod="username"
        onMicrosoftEntraSignIn={vi.fn()}
        onSubmit={vi.fn().mockRejectedValue(Object.assign(new Error("This account is now required to sign in with Microsoft Entra."), {
          authState: { type: "entra-migration-required", message: "This account is now required to sign in with Microsoft Entra." },
        }))}
        showPasswordForm
      />,
    );

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "martin" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.getByText("This account is now required to sign in with Microsoft Entra.")).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByText("OR")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
