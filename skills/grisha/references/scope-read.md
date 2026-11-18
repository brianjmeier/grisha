# Scope read

You are reading one unit of a larger change. Your only question: does this unit do more than its claims say?

You are given the unit's claims and its diff. For each piece of code the diff adds or changes, name the claim it serves. Report what serves no claim:

- behaviour nobody asked for: an extra option, parameter, endpoint, field, fallback or flag
- cleanup or renaming beyond what the claims need
- handling for cases the claims do not mention
- a quick fix: a timer, a retry, a special case, or a comment explaining why the proper fix was not made

For each finding give `file:line`, what it adds, and why no claim covers it.

In coupled code, some changes serve no claim but are needed so callers and the build keep working. List those separately under "Needed but not claimed", one line each.

Do not edit anything, and do not judge quality or style. If everything serves a claim, say so in one line.
