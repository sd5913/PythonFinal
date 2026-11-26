const tokenUrl = "https://github.com/login/oauth/access_token";
const userUrl = "https://api.github.com/user";
const users = {alpha: {id: 1001, login: "flight-alpha"}, beta: {id: 1002, login: "flight-beta"},
  gamma: {id: 1003, login: "flight-gamma"}};

export default {
  async fetch(request) {
    if (request.method === "POST" && request.url === tokenUrl) {
      const form = new URLSearchParams(await request.text());
      const verifier = form.get("code_verifier") || "";
      const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(hashed)))
        .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const [user, expected] = (form.get("code") || "").split(".");
      if (!Object.hasOwn(users, user) || challenge !== expected ||
          form.get("client_id") !== "fixture-id" || form.get("client_secret") !== "fixture-secret" ||
          !/^http:\/\/127\.0\.0\.1:\d+\/api\/auth\/github\/callback$/.test(form.get("redirect_uri"))) {
        return Response.json({error: "invalid_fixture_code"}, {status: 400});
      }
      return Response.json({access_token: "fixture-access-" + user});
    }
    if (request.method === "GET" && request.url === userUrl) {
      const value = request.headers.get("Authorization") || "";
      const user = value.replace(/^Bearer fixture-access-/, "");
      if (Object.hasOwn(users, user) && value.startsWith("Bearer fixture-access-")) {
        return Response.json(users[user]);
      }
    }
    return new Response(null, {status: 404});
  },
};
