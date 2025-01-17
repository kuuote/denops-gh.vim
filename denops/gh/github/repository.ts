import { query } from "./api.ts";
import {
  GetAssignableUsers,
  GetIssueTemplates,
  GetLabels,
  GetMentionableUsers,
  IssueTemplate,
  Label,
  SearchLabels,
  User,
} from "./schema.ts";

export async function getIssueTemplate(args: {
  endpoint?: string;
  repo: {
    owner: string;
    name: string;
  };
}): Promise<IssueTemplate[]> {
  const q = `
{
  repository(owner: "${args.repo.owner}", name: "${args.repo.name}") {
    issueTemplates {
      name
      body
    }
  }
}
`;
  const resp = await query<GetIssueTemplates>(
    {
      endpoint: args.endpoint,
      query: q,
    },
  );

  const t = resp.data.repository.issueTemplates.map((t) => {
    t.body = t.body.replace(/\n/g, "\n");
    return t;
  });
  return t;
}

export async function getMentionableUsers(args: {
  endpoint?: string;
  repo: {
    owner: string;
    name: string;
  };
  word: string;
}): Promise<User[]> {
  const q = `
{
  repository(owner: "${args.repo.owner}", name: "${args.repo.name}") {
    mentionableUsers(first: 10, query: "${args.word}") {
      nodes {
        login
        bio
      }
    }
  }
}
`;

  const resp = await query<GetMentionableUsers>(
    {
      endpoint: args.endpoint,
      query: q,
    },
  );

  return resp.data.repository.mentionableUsers.nodes;
}

export async function getAssignableUsers(args: {
  endpoint?: string;
  repo: {
    owner: string;
    name: string;
  };
  word: string;
}): Promise<User[]> {
  const q = `
{
  repository(owner: "${args.repo.owner}", name: "${args.repo.name}") {
    assignableUsers(first: 10, query: "${args.word}") {
      nodes{
        login
        bio
      }
    }
  }
}
  `;

  const resp = await query<GetAssignableUsers>(
    {
      endpoint: args.endpoint,
      query: q,
    },
  );

  return resp.data.repository.assignableUsers.nodes;
}

export async function searchLabels(args: {
  endpoint?: string;
  repo: {
    owner: string;
    name: string;
  };
  word: string;
}): Promise<Label[]> {
  const q = `
{
  repository(owner: "${args.repo.owner}", name: "${args.repo.name}") {
    labels(first: 10, query: "${args.word}") {
      nodes{
        name
        color
        description
      }
    }
  }
}
  `;

  const resp = await query<SearchLabels>(
    {
      endpoint: args.endpoint,
      query: q,
    },
  );

  return resp.data.repository.labels.nodes;
}

export async function getLabels(args: {
  endpoint?: string;
  repo: {
    owner: string;
    name: string;
  };
  labels: string[];
}): Promise<GetLabels> {
  const labels = args.labels.map((label, i) => {
    return `label${i}: repository(owner:"${args.repo.owner}", name:"${args.repo.name}") {
    label(name: "${label}"){
      ...LabelFragment
    }
  }`;
  });
  const q = `
query {
  ${labels.join("\n")}
}

fragment LabelFragment on Label{
  id
  name
}
  `;

  const resp = await query<GetLabels>({
    query: q,
  });
  return resp;
}
