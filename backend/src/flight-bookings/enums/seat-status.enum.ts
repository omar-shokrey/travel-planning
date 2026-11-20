/** FLT-28: a seat on a booking's seat map. `taken` never says by whom. */
export enum SeatStatus {
  Available = 'available',
  Taken = 'taken',
  Yours = 'yours',
}
