import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 50 }, // naik ke 50 user
    { duration: "2m", target: 50 }, // stabil
    { duration: "1m", target: 100 }, // naik ke 100 user
    { duration: "2m", target: 100 }, // stabil
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% response time harus < 500ms
    http_req_failed: ["rate<0.01"], // error < 1%
  },
};

export default function () {
  const res = http.get("http://localhost:3000/schedules");
  check(res, {
    "status 200": (r) => r.status === 200,
  });
}
