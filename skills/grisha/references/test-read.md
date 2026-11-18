# Test read

You are reading the tests that one unit of a larger change adds or edits. Your only question: could a test here pass while its claim is false, or fail while the behaviour is still right?

You are given the unit's claims and its diff. Read each test as a caller of the code: someone who uses its public interface and knows nothing else. Report a test that:

- asserts what a caller cannot see: which functions ran, how often, in what order or with what arguments, or the text of a query or request the code built
- replaces code this repository owns with a fake, a mock or a spy. Only the outside world may be faked: another company's service, the clock, timers, random values and ids, files, processes, the environment
- fakes the outside world by patching a global or a module, instead of passing a different implementation through a required parameter
- reads the real clock, sleeps, or names a date that will one day be in the past
- builds its state by hand (SQL, hand-written objects, a cast such as `as any`) where a factory or the code's own interface could build it
- reaches the code through a door no real caller uses: a private import, or a flag, option or helper that exists only for tests
- checks who may see or change something by setting the database role itself, instead of making the request as that user
- shows hidden data stays hidden by pinning the text of the filter, instead of adding the data and showing it never comes back
- proves again, through fakes, what another test in the diff already proves against the real thing
- is named for how the code works ("calls X, then Y") instead of the outcome ("returns … when …")
- asserts nothing about a result or a state

One exception. A test may pin the exact shape of something the code produces when a system the tests cannot run will read it, such as a payload sent to another company's service. The test must say so.

For each finding give `file:line`, which point it breaks, and the test a caller would write to prove the same claim.

Do not edit anything, and do not judge the product code. If every test reads as a caller's, say so in one line.
