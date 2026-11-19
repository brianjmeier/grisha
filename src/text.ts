import { createHash } from "node:crypto"

export const sha = (text: string) => createHash("sha256").update(text).digest("hex")

export const lines = (text: string) => text.split("\n").filter(Boolean)

export const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

export const labelled = (list: string, index: number, name: unknown) => `${list}[${index}]${isText(name) ? ` "${name}"` : ""}`

export const counted = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`
