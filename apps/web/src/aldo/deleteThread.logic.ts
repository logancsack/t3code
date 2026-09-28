/**
 * Whether deleting a thread can go straight to Aldo, deleting its machine
 * with it, instead of first sending the delete to the machine (which wakes a
 * sleeping one). True when it's the only thread on its machine, as every Aldo
 * thread normally is; threads already deleted in the same batch don't count.
 * A machine with other threads keeps them, so it gets the delete as usual.
 */
export function aldoThreadIsAloneOnMachine(input: {
  readonly threadId: string;
  /** The machine's threads, as the client knows them. */
  readonly machineThreadIds: ReadonlyArray<string>;
  /** Threads of the same batch that are already deleted. */
  readonly deletedThreadIds?: ReadonlySet<string> | undefined;
}): boolean {
  const { threadId, machineThreadIds, deletedThreadIds } = input;
  return (
    machineThreadIds.includes(threadId) &&
    machineThreadIds.every((id) => id === threadId || deletedThreadIds?.has(id) === true)
  );
}
