export class ParamBuffer {
  readonly values: unknown[] = [];

  add(value: unknown): number {
    this.values.push(value);
    return this.values.length;
  }
}
