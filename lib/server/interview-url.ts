export function getInterviewAppUrl() {
  return (
    process.env.CALM_ROOM_APP_URL ||
    process.env.NEXT_PUBLIC_CALM_ROOM_URL ||
    process.env.NEXT_PUBLIC_CALM_ROOM_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://calm-room.verisnova.com"
  )
}
