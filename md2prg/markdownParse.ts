export interface MarkdownNode {
  title: string;
  content: string;
  children: MarkdownNode[];
}

export function parseMarkdownToJSON(markdown: string): MarkdownNode[] {
  const lines = markdown.split("\n");
  const root: MarkdownNode[] = [];
  const stack: { node: MarkdownNode; level: number }[] = [];

  for (const line of lines) {
    const titleMatch = line.match(/^(#+)\s*(.*)/);
    if (titleMatch) {
      const level = titleMatch[1].length;
      const title = titleMatch[2].trim();

      const newNode: MarkdownNode = {
        title,
        content: "",
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newNode);
      } else {
        stack[stack.length - 1].node.children.push(newNode);
      }

      stack.push({ node: newNode, level });
    } else if (line.trim()) {
      if (stack.length > 0) {
        const current = stack[stack.length - 1].node;
        current.content += line + "\n";
        current.content = current.content.trim();
      }
    }
  }

  return root;
}
