export interface SpringState {
  value: number;
  velocity: number;
}
/**
 * Exact constant-target solution of x'' + 2*zeta*omega*x' + omega^2*(x-target)=0.
 * Mutates reusable state only after validating both inputs and resulting output.
 * Frequency is Hz, damping is the dimensionless ratio; dt is seconds in [0, 0.1].
 */
export function advanceDampedSpring(
  state: SpringState,
  target: number,
  frequency: number,
  damping: number,
  dt: number,
): void {
  if (!Number.isFinite(state.value) || !Number.isFinite(state.velocity) || !Number.isFinite(target))
    throw new RangeError('Spring state and target must be finite.');
  if (!Number.isFinite(frequency) || frequency < 0.1 || frequency > 20)
    throw new RangeError('Spring frequency must be 0.1–20 Hz.');
  if (!Number.isFinite(damping) || damping < 0 || damping > 2)
    throw new RangeError('Spring damping ratio must be between 0 and 2.');
  if (!Number.isFinite(dt) || dt < 0 || dt > 0.1)
    throw new RangeError('Spring step must be between 0 and 0.1 seconds.');
  if (dt === 0 || (state.value === target && state.velocity === 0)) return;
  const omega = 2 * Math.PI * frequency,
    alpha = omega * damping,
    beta = omega * Math.sqrt(Math.abs(1 - damping * damping)),
    q = beta * dt,
    over = damping > 1;
  // One formula covers under/critical/overdamping without subtracting nearby roots.
  // At critical damping beta=0, sin(q)/beta tends exactly to dt.
  const square = q * q,
    sinc =
      q < 1e-4
        ? 1 + (over ? square : -square) / 6 + (square * square) / 120
        : (over ? Math.sinh(q) : Math.sin(q)) / q,
    sine = dt * sinc,
    cosine = over ? Math.cosh(q) : Math.cos(q),
    decay = Math.exp(-alpha * dt),
    error = state.value - target;
  const value = target + decay * (error * cosine + (state.velocity + alpha * error) * sine),
    velocity = decay * (state.velocity * cosine - (alpha * state.velocity + omega * omega * error) * sine);
  if (!Number.isFinite(value) || !Number.isFinite(velocity))
    throw new RangeError('Spring output exceeds finite precision.');
  state.value = value;
  state.velocity = velocity;
}
