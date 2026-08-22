import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Boards mirror themselves to the backend on a debounce; that seam is not
// what these tests exercise, so stub it out.
vi.mock("@/lib/api", () => ({ mirror: vi.fn() }));

import CustomBoards from "./CustomBoards";

const setup = () => render(<CustomBoards itemsBoard={<div>ITEMS_BOARD_CONTENT</div>} />);

describe("CustomBoards — Vault items board is opt-in (item #5)", () => {
  it("opens on the user's own board, with no Vault items tab by default", async () => {
    setup();
    // The seeded sample board is present...
    expect(await screen.findByRole("tab", { name: /Feature: Vault backend/ })).toBeInTheDocument();
    // ...but the automatic Vault items board is not shown.
    expect(screen.queryByRole("tab", { name: /Vault items/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ITEMS_BOARD_CONTENT")).not.toBeInTheDocument();
    // The opt-in control is offered instead.
    expect(screen.getByRole("button", { name: /Vault items board/ })).toBeInTheDocument();
  });

  it("adds the Vault items board on demand, then hides it again", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("tab", { name: /Feature: Vault backend/ });

    await user.click(screen.getByRole("button", { name: /Vault items board/ }));

    // Tab appears, its content renders, and the control flips to "Hide".
    expect(screen.getByRole("tab", { name: /Vault items/ })).toBeInTheDocument();
    expect(screen.getByText("ITEMS_BOARD_CONTENT")).toBeInTheDocument();
    const hideBtn = screen.getByRole("button", { name: /Hide Vault items/ });

    // The choice persists.
    expect(JSON.parse(localStorage.getItem("vault.boards.v1")).showItems).toBe(true);

    await user.click(hideBtn);
    expect(screen.queryByRole("tab", { name: /Vault items/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ITEMS_BOARD_CONTENT")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("vault.boards.v1")).showItems).toBe(false);
  });

  it("shows a 'No boards yet' empty state after the last board is deleted", async () => {
    const user = userEvent.setup();
    setup();
    const tab = await screen.findByRole("tab", { name: /Feature: Vault backend/ });
    expect(tab).toBeInTheDocument();

    // Delete is a click-again-to-confirm control: it arms on the first click
    // ("Sure? Click again") and deletes on the second.
    await user.click(screen.getByRole("button", { name: /Delete board/ }));
    await user.click(screen.getByRole("button", { name: /Sure\? Click again/ }));

    expect(await screen.findByText(/No boards yet/)).toBeInTheDocument();
    // Both recovery actions are offered.
    const empty = screen.getByText(/No boards yet/).closest(".board-empty");
    expect(within(empty).getByRole("button", { name: /New board/ })).toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: /Vault items board/ })).toBeInTheDocument();
  });
});
