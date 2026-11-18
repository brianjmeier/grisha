export const lines = (text: string) => text.split("\n").filter(Boolean)

export const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

export const labelled = (list: string, index: number, name: unknown) => `${list}[${index}]${isText(name) ? ` "${name}"` : ""}`
