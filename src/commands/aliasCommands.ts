import * as vscode from "vscode";
import { SSHHostAliasRepair } from "../core/sshAlias";
import { StorageService } from "../core/storage";
import { getErrorMessage, showTransientInfo } from "../core/utils";

const DISMISSED_REPAIR_SIGNATURE_KEY = "sshKit.dismissedLegacyAliasRepairSignature";
const MAX_REPAIR_PREVIEW_ITEMS = 10;

/** Preview and repair aliases left stale by nickname edits in older versions. */
export async function reviewLegacyHostAliasRepairs(
  storage: StorageService
): Promise<number> {
  const repairs = storage.getLegacyHostAliasRepairs();
  if (repairs.length === 0) {
    showTransientInfo(
      vscode.l10n.t("No renamed SSH Host aliases need repair.")
    );
    return 0;
  }

  const repairAction = vscode.l10n.t("Create Snapshot and Repair");
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t("Repair {count} renamed SSH Host aliases?", {
      count: repairs.length,
    }),
    {
      modal: true,
      detail: buildRepairPreview(repairs),
    },
    repairAction
  );
  if (confirmed !== repairAction) {return 0;}

  let repaired: SSHHostAliasRepair[];
  try {
    repaired = await storage.repairLegacyHostAliases(repairs);
  } catch (error) {
    vscode.window.showErrorMessage(vscode.l10n.t(
      "Failed to repair renamed SSH Host aliases: {error}",
      { error: getErrorMessage(error) }
    ));
    return 0;
  }
  if (repaired.length === 0) {
    showTransientInfo(
      vscode.l10n.t("No renamed SSH Host aliases need repair.")
    );
    return 0;
  }

  showTransientInfo(
    vscode.l10n.t("Repaired {count} renamed SSH Host aliases.", {
      count: repaired.length,
    })
  );
  return repaired.length;
}

/** Offer one upgrade review for each distinct set of stale aliases. */
export async function offerLegacyHostAliasRepair(
  context: vscode.ExtensionContext,
  storage: StorageService
): Promise<void> {
  try {
    const repairs = storage.getLegacyHostAliasRepairs();
    if (repairs.length === 0) {
      await rememberRepairSignature(context, undefined);
      return;
    }

    const signature = getRepairSignature(repairs);
    if (context.globalState.get<string>(DISMISSED_REPAIR_SIGNATURE_KEY) === signature) {
      return;
    }

    // Record before opening the prompt so concurrently restored windows do not
    // repeatedly offer the same catalog repair.
    await rememberRepairSignature(context, signature);
    const reviewAction = vscode.l10n.t("Review");
    const selected = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        "SSH Kit found {count} hosts whose SSH Host alias may still use an older nickname.",
        { count: repairs.length }
      ),
      reviewAction
    );
    if (selected !== reviewAction) {return;}

    const repairedCount = await reviewLegacyHostAliasRepairs(storage);
    if (repairedCount > 0 || storage.getLegacyHostAliasRepairs().length === 0) {
      await rememberRepairSignature(context, undefined);
    }
  } catch (error) {
    vscode.window.showErrorMessage(vscode.l10n.t(
      "Failed to review renamed SSH Host aliases: {error}",
      { error: getErrorMessage(error) }
    ));
  }
}

function buildRepairPreview(repairs: readonly SSHHostAliasRepair[]): string {
  const preview = repairs
    .slice(0, MAX_REPAIR_PREVIEW_ITEMS)
    .map((repair) => `${repair.name}: ${repair.currentAlias || vscode.l10n.t("(missing)")} → ${repair.suggestedAlias}`);
  const remaining = repairs.length - preview.length;
  if (remaining > 0) {
    preview.push(vscode.l10n.t("...and {count} more", { count: remaining }));
  }
  return [
    vscode.l10n.t("The following managed Host names will be updated:"),
    "",
    ...preview,
    "",
    vscode.l10n.t("SSH Kit will create an internal snapshot first. Remote-SSH targets saved under old aliases may need to be reopened from SSH Kit."),
  ].join("\n");
}

function getRepairSignature(repairs: readonly SSHHostAliasRepair[]): string {
  return JSON.stringify(
    [...repairs]
      .sort((left, right) => left.hostId.localeCompare(right.hostId))
      .map(({ hostId, name, currentAlias, suggestedAlias }) => [
        hostId,
        name,
        currentAlias,
        suggestedAlias,
      ])
  );
}

async function rememberRepairSignature(
  context: vscode.ExtensionContext,
  signature: string | undefined
): Promise<void> {
  try {
    await context.globalState.update(DISMISSED_REPAIR_SIGNATURE_KEY, signature);
  } catch {
    // This value only suppresses a repeated prompt; it must never block repair.
  }
}
