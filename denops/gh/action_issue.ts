import { autocmd, Denops, open, stringWidth } from "./deps.ts";
import {
  ActionContext,
  getActionCtx,
  isActionContext,
  isIssueListArgs,
  IssueListArg,
  setActionCtx,
} from "./action.ts";
import { getIssue, getIssues, updateIssue } from "./github/issue.ts";
import { getUsers } from "./github/user.ts";
import { getIssueTemplate, getLabels } from "./github/repository.ts";
import { isIssueItem, IssueItem, IssueTemplate } from "./github/schema.ts";
import { obj2array } from "./utils/formatter.ts";
import { map } from "./mapping.ts";
import {
  inprogress,
  menu,
  runTerminal,
  textEncoder,
  vimRegister,
} from "./utils/helper.ts";

export async function actionEditIssue(denops: Denops, ctx: ActionContext) {
  await inprogress(denops, "loading...", async () => {
    const schema = ctx.schema;
    if (!schema.issue) {
      throw new Error(`invalid schema: ${schema}`);
    }

    try {
      const issue = await getIssue({
        cond: {
          owner: schema.owner,
          repo: schema.repo,
          number: schema.issue.number,
        },
      });
      await denops.cmd("set ft=markdown buftype=acwrite");
      await denops.call("setline", 1, issue.body.split("\n"));
      await denops.cmd("setlocal nomodified");

      ctx.args = issue;
      setActionCtx(denops, ctx);

      await autocmd.group(
        denops,
        `gh_issue_edit_${schema.issue.number}`,
        (helper) => {
          helper.remove("*", "<buffer>");
          helper.define(
            "BufWriteCmd",
            "<buffer>",
            `call gh#_action("issues:update")`,
          );
        },
      );

      const keyMaps = [
        {
          defaultKey: "gha",
          lhs: "<Plug>(gh-issue-assignees)",
          rhs: `:<C-u>call gh#_action("issues:assignees")<CR>`,
        },
        {
          defaultKey: "ghl",
          lhs: "<Plug>(gh-issue-labels)",
          rhs: `:<C-u>call gh#_action("issues:labels")<CR>`,
        },
      ];

      for (const m of keyMaps) {
        await map(
          denops,
          m.defaultKey,
          m.lhs,
          m.rhs,
          {
            buffer: true,
            silent: true,
            mode: "n",
            noremap: true,
          },
        );
      }
      await denops.cmd("doautocmd User gh_open_issue");
    } catch (e) {
      console.error(e.message);
    }
  });
}

export async function actionUpdateIssue(denops: Denops, ctx: ActionContext) {
  if (!await denops.eval("&modified")) {
    // if issue body doesn't changed, do nothing
    return;
  }

  if (!isIssueItem(ctx.args)) {
    console.error(`ctx.args is not IssutItem: ${Deno.inspect(ctx.args)}`);
    return;
  }

  const body = await denops.eval(`getline(1, "$")`) as string[];
  if (body.length === 1 && body[0] === "") {
    console.error("issue body cannot be empty");
    return;
  }

  const input = {
    id: ctx.args.id,
    body: body.join("\r\n"),
  };
  inprogress(denops, "updating...", async () => {
    try {
      await updateIssue({ input });
      await denops.cmd("setlocal nomodified");
    } catch (e) {
      console.error(e.message);
    }
  });
}

export async function actionListIssue(denops: Denops, ctx: ActionContext) {
  if (!isActionContext(ctx)) {
    console.error(`ctx is not action context: ${Deno.inspect(ctx)}`);
    return;
  }
  if (!isIssueListArgs(ctx.args)) {
    console.error("ctx.args type is not 'IssueListArg'");
    return;
  }
  const args = ctx.args;

  const schema = ctx.schema;
  denops.cmd("setlocal ft=gh-issues modifiable");

  await inprogress(denops, "loading...", async () => {
    try {
      const issues = await getIssues({
        cond: {
          first: 30,
          owner: schema.owner,
          name: schema.repo,
          Filter: args.filters,
        },
      });
      if (issues.nodes.length === 0) {
        throw new Error("not found any issues");
      }
      await denops.cmd("silent %d_");
      await setIssueToBuffer(denops, ctx, issues.nodes);

      const keyMaps = [
        {
          defaultKey: "ghe",
          lhs: "<Plug>(gh-issue-edit)",
          rhs: `:<C-u>call gh#_action("issues:edit")<CR>`,
        },
        {
          defaultKey: "ghn",
          lhs: "<Plug>(gh-issue-new)",
          rhs: `:<C-u>new gh://${schema.owner}/${schema.repo}/issues/new<CR>`,
        },
        {
          defaultKey: "<C-o>",
          lhs: "<Plug>(gh-issue-view)",
          rhs: `:<C-u>call gh#_action("issues:view")<CR>`,
        },
        {
          defaultKey: "ghy",
          lhs: "<Plug>(gh-issue-yank)",
          rhs: `:<C-u>call gh#_action("issues:yank")<CR>`,
        },
        {
          defaultKey: "<C-j>",
          lhs: "<Plug>(gh-issue-select-next)",
          rhs: `:<C-u>call gh#_select_toggle('+')<CR>`,
        },
        {
          defaultKey: "<C-k>",
          lhs: "<Plug>(gh-issue-select-prev)",
          rhs: `:<C-u>call gh#_select_toggle('-')<CR>`,
        },
        {
          defaultKey: "ghs",
          lhs: "<Plug>(gh-issue-search)",
          rhs: `:<C-u>call gh#_action("issues:search")<CR>`,
        },
        {
          defaultKey: "ghc",
          lhs: "<Plug>(gh-issue-close)",
          rhs: `:<C-u>call gh#_action("issues:close")<CR>`,
        },
        {
          defaultKey: "gho",
          lhs: "<Plug>(gh-issue-open)",
          rhs: `:<C-u>call gh#_action("issues:open")<CR>`,
        },
      ];

      for (const m of keyMaps) {
        await map(
          denops,
          m.defaultKey,
          m.lhs,
          m.rhs,
          {
            buffer: true,
            silent: true,
            mode: "n",
            noremap: true,
          },
        );
      }
    } catch (e) {
      console.error(e.message);
    }
  });
}

export async function setIssueToBuffer(
  denops: Denops,
  ctx: ActionContext,
  issues: IssueItem[],
): Promise<void> {
  const objs = issues.map((issue) => {
    return {
      number: "#" + issue.number,
      title: stringWidth(issue.title) >= 100
        ? issue.title.slice(0, 100) + "..."
        : issue.title,
      state: issue.state as string,
      assignees: issue.assignees.nodes.slice(0, 2).map((user) => {
        return user?.login ? "@" + user.login : "";
      }).join(" "),
      labels: `(${
        issue.labels.nodes.slice(0, 3).map((label) => label.name).join(", ")
      })`,
      comment: issue.comments.nodes.length
        ? `\uf41f ${issue.comments.nodes.length}`
        : "",
    };
  });
  const rows = obj2array(objs);
  await denops.call("setline", 1, rows);
  await denops.cmd("setlocal nomodifiable");

  (ctx.args as IssueListArg).issues = issues;
  await setActionCtx(denops, ctx);
}

export async function actionNewIssue(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  const templates = await inprogress<IssueTemplate[]>(
    denops,
    "loading...",
    async () => {
      const templates = await getIssueTemplate({
        repo: {
          owner: ctx.schema.owner,
          name: ctx.schema.repo,
        },
      });
      templates.push({ name: "Blank", body: "" });
      return templates;
    },
  );

  const templs = templates!.map((t) => t.name);
  await menu(denops, templs, async (arg: unknown) => {
    const name = arg as string;
    const template = templates!.filter((t) => t.name == name)[0];
    await denops.cmd("setlocal ft=markdown buftype=acwrite");
    if (name !== "Blank") {
      await denops.call("setline", 1, template.body.split("\n"));
    }
    await denops.cmd("setlocal nomodified");

    const bufnr = denops.call("bufnr");

    await autocmd.group(
      denops,
      `gh_issue_new_${bufnr}`,
      (helper) => {
        helper.remove("*", "<buffer>");
        helper.define(
          "BufWriteCmd",
          "<buffer>",
          `call gh#_action("issues:create")`,
        );
      },
    );

    await denops.cmd("doautocmd User gh_open_issue");
  });
}

export async function actionCreateIssue(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  const text = (await denops.eval(`getline(1, "$")`) as string[]).join("\n");
  const data = textEncoder.encode(text);
  const tmp = await Deno.makeTempFile();
  const issueBufnr = await denops.call("bufnr");
  await Deno.writeFile(tmp, data);

  await runTerminal(denops, [
    "gh",
    "issue",
    "create",
    "-F",
    tmp,
    "-R",
    `${ctx.schema.owner}/${ctx.schema.repo}`,
  ], async (denops, exitCode) => {
    if (exitCode === 0) {
      const text = await denops.eval(`getline(1, "$")`) as string[];
      for (let i = text.length - 1; i > 0; i--) {
        const url = text[i];
        if (url.substring(0, 18) === "https://github.com") {
          const path = text[i].substring(19);
          await denops.cmd("bw!");
          await denops.cmd(`bw! ${issueBufnr}`);
          const chosen = await denops.call("gh#_chose_action", [
            { text: "(e)dit", value: "edit" },
            { text: "(y)nk issue url", value: "yank" },
            { text: "(o)open browser", value: "open" },
          ]) as string;

          switch (chosen) {
            case "edit":
              await denops.cmd(`e gh://${path}`);
              break;
            case "yank":
              await denops.call("setreg", vimRegister, url);
              console.log(`yanked: ${url}`);
              break;
            case "open":
              open(url);
              break;
          }
          break;
        }
      }
    }
  });
}

export async function actionViewIssue(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  if (!isIssueListArgs(ctx.args)) {
    console.error(`ctx.args type is not 'IssueListArg'`);
    return;
  }
  if (ctx.args.issues!.length == 0) {
    return;
  }
  const idxs = await denops.call("gh#_get_selected_idx") as number[];
  if (!idxs.length) {
    const idx = (await denops.call("line", ".") as number) - 1;
    idxs.push(idx);
  }
  for (const idx of idxs) {
    const issue = ctx.args.issues![idx];
    open(issue.url);
  }
  await denops.call("gh#_clear_selected");
}

export async function actionSearchIssues(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  await actionListIssue(denops, ctx);
}

export async function actionOpenIssue(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  await changeIssueState(denops, ctx, "OPEN");
}

export async function actionCloseIssue(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  await changeIssueState(denops, ctx, "CLOSED");
}

export async function changeIssueState(
  denops: Denops,
  ctx: ActionContext,
  state: "OPEN" | "CLOSED",
): Promise<void> {
  if (!isIssueListArgs(ctx.args)) {
    console.error(`ctx.args type is not 'IssueListArg'`);
    return;
  }
  if (!ctx.args.issues) {
    return;
  }

  const issues = ctx.args.issues;

  if (issues.length == 0) {
    return;
  }

  const idxs = await denops.call("gh#_get_selected_idx") as number[];
  if (!idxs.length) {
    const idx = (await denops.call("line", ".") as number) - 1;
    idxs.push(idx);
  }

  const text = state === "OPEN" ? "opening..." : "closing...";
  await inprogress(denops, text, async () => {
    for (const idx of idxs) {
      const issue = issues[idx];
      await updateIssue({
        input: {
          id: issue.id,
          state: state,
        },
      });
    }
  });
  await actionSearchIssues(denops, await getActionCtx(denops));
  await denops.call("gh#_clear_selected");
}

export async function actionListAssignees(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  await inprogress(denops, "loading...", async () => {
    const schema = ctx.schema;
    if (!schema.issue) {
      throw new Error(`invalid schema: ${schema}`);
    }

    try {
      const issue = await getIssue({
        cond: {
          owner: schema.owner,
          repo: schema.repo,
          number: schema.issue.number,
        },
      });
      await denops.cmd("set ft=markdown buftype=acwrite");
      const users = issue.assignees.nodes.map((user) => user.login);
      await denops.call("setline", 1, users);
      await denops.cmd("setlocal nomodified");

      ctx.args = issue;
      setActionCtx(denops, ctx);

      await autocmd.group(
        denops,
        `gh_issue_assignees_${schema.issue.number}`,
        (helper) => {
          helper.remove("*", "<buffer>");
          helper.define(
            "BufWriteCmd",
            "<buffer>",
            `call gh#_action("issues:assignees:update")`,
          );
        },
      );

      await denops.cmd("doautocmd User gh_open_issue_assignees");
    } catch (e) {
      console.error(e.message);
    }
  });
}

export async function actionUpdateAssignees(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  if (!await denops.eval("&modified")) {
    // if issue body doesn't changed, do nothing
    return;
  }
  const lines = (await denops.call("getline", 1, "$") as string[]).filter((l) =>
    l !== ""
  );
  let assignees: string[] = [];

  await inprogress(denops, "updating...", async () => {
    if (lines.length > 0) {
      if (lines.length > 10) {
        throw new Error("cannot assign more than 10 users");
      }
      const users = await getUsers({
        assignees: lines,
      });

      assignees = Object.values(users.data).map(
        (user) => user.id,
      );
    }

    await updateIssue({
      input: {
        id: (ctx.args as IssueItem).id,
        assignees: assignees,
      },
    });
    await denops.cmd("setlocal nomodified");
  });
}

export async function actionListLabels(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  await inprogress(denops, "loading...", async () => {
    const schema = ctx.schema;
    if (!schema.issue) {
      throw new Error(`invalid schema: ${schema}`);
    }

    try {
      const issue = await getIssue({
        cond: {
          owner: schema.owner,
          repo: schema.repo,
          number: schema.issue.number,
        },
      });
      await denops.cmd("set ft=markdown buftype=acwrite");
      const labels = issue.labels.nodes.map((label) => label.name);
      await denops.call("setline", 1, labels);
      await denops.cmd("setlocal nomodified");

      ctx.args = issue;
      setActionCtx(denops, ctx);

      await autocmd.group(
        denops,
        `gh_issue_labels_${schema.issue.number}`,
        (helper) => {
          helper.remove("*", "<buffer>");
          helper.define(
            "BufWriteCmd",
            "<buffer>",
            `call gh#_action("issues:labels:update")`,
          );
        },
      );

      await denops.cmd("doautocmd User gh_open_issue_labels");
    } catch (e) {
      console.error(e.message);
    }
  });
}

export async function actionUpdateLabels(
  denops: Denops,
  ctx: ActionContext,
): Promise<void> {
  if (!await denops.eval("&modified")) {
    // if issue body doesn't changed, do nothing
    return;
  }
  const lines = (await denops.call("getline", 1, "$") as string[]).filter((l) =>
    l !== ""
  );
  let labels: string[] = [];

  await inprogress(denops, "updating...", async () => {
    if (lines.length > 0) {
      const resp = await getLabels({
        repo: {
          owner: ctx.schema.owner,
          name: ctx.schema.repo,
        },
        labels: lines,
      });

      labels = Object.values(resp.data).map(
        (repo) => repo.label.id,
      );
    }

    await updateIssue({
      input: {
        id: (ctx.args as IssueItem).id,
        labels: labels,
      },
    });
    await denops.cmd("setlocal nomodified");
  });
}
