const GAME_PLACE_ID = 11379739543;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();

    if (!signature || !timestamp) return new Response("Missing headers", { status: 401 });

    const isValid = await verifySignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValid) return new Response("Invalid request signature", { status: 401 });

    const interaction = JSON.parse(body);

    // Ping
    if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

    // Slash Command
    if (interaction.type === 2 && interaction.data.name === "search") {
      const userId = interaction.data.options.find(opt => opt.name === "id").value;

      try {
        // حفظ الآي دي في قائمة المراقبة عشان الـ Cron يفحصه بعدين
        let trackedUsersStr = await env.ROBLOX_KV.get("tracked_users_list");
        let trackedUsers = trackedUsersStr ? JSON.parse(trackedUsersStr) : [];
        if (!trackedUsers.includes(userId)) {
            trackedUsers.push(userId);
            await env.ROBLOX_KV.put("tracked_users_list", JSON.stringify(trackedUsers));
        }

        // جلب معلومات الحساب
        const userRes = await fetch(`https://users.roblox.com/v1/users/${userId}`);
        if (!userRes.ok) throw new Error("User not found");
        const user = await userRes.json();

        // جلب صورة الحساب
        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
        const thumbData = await thumbRes.json();
        const avatarUrl = thumbData.data[0]?.imageUrl || "";

        // جلب حالة اللاعب (Presence API)
        let lastOnlineText = "غير معروف";
        let currentStatus = "Offline";
        
        const presenceRes = await fetch(`https://presence.roblox.com/v1/presence/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [parseInt(userId)] })
        });
        const presenceData = await presenceRes.json();
        const presence = presenceData.userPresences[0];

        if (presence) {
          if (presence.lastOnline) {
            lastOnlineText = new Date(presence.lastOnline).toLocaleString('en-US', { timeZone: 'UTC' }) + " (UTC)";
          }
          if (presence.userPresenceType === 2) {
            currentStatus = `In Game (Place ID: ${presence.placeId})`;
          } else if (presence.userPresenceType === 1) {
            currentStatus = "Online (Website)";
          }
        }

        // جلب آخر مرة دخل الماب المحدد من الكلاود (KV)
        let lastJoinedSpecificGame = await env.ROBLOX_KV.get(`last_join_${userId}`);
        if (!lastJoinedSpecificGame) {
            lastJoinedSpecificGame = "لا يوجد تسجيل سابق";
        } else {
            lastJoinedSpecificGame = new Date(parseInt(lastJoinedSpecificGame)).toLocaleString('en-US', { timeZone: 'UTC' }) + " (UTC)";
        }

        const createdDate = new Date(user.created).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // بناء الـ Embed
        const embed = {
          color: 0x2b2d31,
          author: { name: `${user.name} ( ${user.id} )`, icon_url: avatarUrl },
          title: "Roblox Information",
          description: `**Account Created:** ${createdDate}\n\n**Current Status:** ${currentStatus}\n**Last Online (Anywhere):** ${lastOnlineText}\n\n**Last Joined Map (${GAME_PLACE_ID}):**\n> \`${lastJoinedSpecificGame}\`\n\nThe current version of this bot (V2) was created around June 2026, so V2 detections date back to that time.`,
          thumbnail: { url: avatarUrl },
          fields: [{ name: "No connected accounts found.", value: "\u200b" }]
        };

        const components = [
          {
            type: 1,
            components: [
              { type: 2, custom_id: "config_btn", label: "Search Configuration", style: 1 },
              { type: 2, custom_id: "info_btn", label: "Info", style: 2 }
            ]
          }
        ];

        return new Response(JSON.stringify({
          type: 4,
          data: { embeds: [embed], components: components }
        }), { headers: { "Content-Type": "application/json" } });

      } catch (error) {
        return new Response(JSON.stringify({
          type: 4, data: { content: "ما لقيت الحساب أو صار خطأ في الـ API.", flags: 64 }
        }), { headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response("Unknown", { status: 400 });
  },

  // الخدمة اللي تشتغل في الخلفية (Cron) كل دقيقة عشان تسجل آخر دخول للماب
  async scheduled(event, env, ctx) {
    const trackedUsersStr = await env.ROBLOX_KV.get("tracked_users_list");
    if (!trackedUsersStr) return;

    const trackedUsers = JSON.parse(trackedUsersStr);
    if (trackedUsers.length === 0) return;

    try {
      const presenceRes = await fetch(`https://presence.roblox.com/v1/presence/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: trackedUsers.map(id => parseInt(id)) })
      });
      const presenceData = await presenceRes.json();

      for (const presence of presenceData.userPresences) {
        if (presence.userPresenceType === 2 && presence.placeId === GAME_PLACE_ID) {
          await env.ROBLOX_KV.put(`last_join_${presence.userId}`, Date.now().toString());
        }
      }
    } catch (err) {
      console.error("Cron tracking error:", err);
    }
  }
};

// دالة التحقق من توقيع ديسكورد
async function verifySignature(body, signature, timestamp, publicKeyHex) {
  const encoder = new TextEncoder();
  const message = encoder.encode(timestamp + body);
  const hexToUint8Array = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", hexToUint8Array(publicKeyHex), { name: "Ed25519", namedCurve: "Ed25519" }, false, ["verify"]);
  return await crypto.subtle.verify({ name: "Ed25519" }, key, hexToUint8Array(signature), message);
}
