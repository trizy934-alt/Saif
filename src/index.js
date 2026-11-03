const GAME_PLACE_ID = 11379739543;
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1567026479882043452/iSHLbw6Yie1UZ8E1_9eEA3BFldXqvjuuZpmaOt8u7ZDVtHkfAH6cIp9wzgU43C0LCKTP";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let userId = url.searchParams.get("id");

    // دعم لو تبي ترسل الطلب بـ POST
    if (request.method === "POST") {
      try {
        const body = await request.json();
        userId = userId || body.id || body.userId;
      } catch (e) {}
    }

    if (!userId) {
      return new Response("Please provide a user ID. Example: /?id=123456", { status: 400 });
    }

    try {
       // حفظ الآي دي في قائمة المراقبة (عشان الـ Cron يحدث آخر دخول للماب)
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

       // جلب حالة اللاعب
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
         if (presence.lastOnline) lastOnlineText = new Date(presence.lastOnline).toLocaleString('en-US', { timeZone: 'UTC' }) + " (UTC)";
         if (presence.userPresenceType === 2) currentStatus = `In Game (Place ID: ${presence.placeId})`;
         else if (presence.userPresenceType === 1) currentStatus = "Online (Website)";
       }

       // جلب آخر دخول للماب
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

       // بناء الأزرار
       const components = [
         {
           type: 1,
           components: [
             { type: 2, custom_id: "config_btn", label: "Search Configuration", style: 1 },
             { type: 2, custom_id: "info_btn", label: "Info", style: 2 }
           ]
         }
       ];

       // إرسال البيانات إلى الويبهوك مباشرة
       const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({
               embeds: [embed],
               components: components
           })
       });

       if (!discordRes.ok) throw new Error("فشل الإرسال للويبهوك، تأكد من الرابط.");

       return new Response("تم إرسال المعلومات إلى ديسكورد بنجاح!", { status: 200 });

    } catch (err) {
       return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },

  // الفحص في الخلفية (Cron) لتحديث آخر دخول للماب
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
