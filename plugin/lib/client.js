// dsh-subagent-default-model client — settings panel for the subagent default model.
// Extracted from @aaravarr/dsh-subagent-max (licensed MIT) and adapted as a
// standalone client entry for this plugin.

window.__ModuleLoader__.load({
  id: "dsh-subagent-default-model",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Button = primitives.Button;
    var Toast = primitives.Toast;

    // ── CSS ──────────────────────────────────────────────────────────────
    var SETTINGS_CSS = ".dsm-model-settings{display:flex;flex-direction:column;gap:14px;margin:20px 0;padding:14px 16px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#1c1d21));border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px}.dsm-model-settings-head{display:flex;flex-direction:column;gap:4px}.dsm-model-settings-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}.dsm-model-settings-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-list{display:flex;flex-direction:column;gap:8px}.dsm-model-settings-route{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;padding:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px}.dsm-model-settings-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.dsm-model-settings-select{width:100%;height:32px;padding:0 28px 0 9px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#232529);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit}.dsm-model-settings-select:focus{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:1px}.dsm-model-settings-remove{height:32px;min-width:32px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8);cursor:pointer}.dsm-model-settings-remove:hover{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,90,90,.15))}.dsm-model-settings-options{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.dsm-model-settings-strategy{min-width:180px}.dsm-model-settings-actions{display:flex;align-items:center;gap:8px}.dsm-model-settings-status{font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary,#22c55e)}.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}.dsm-plugin-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;transition:transform .16s}.dsm-plugin-card-chevron-open{transform:rotate(180deg)}.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}.dsm-plugin-card-body .dsm-model-settings{margin:0;padding:12px 0 0;background:transparent;border:0;border-radius:0}.dsm-plugin-card-body .dsm-model-settings-head{display:none}.dsm-model-settings-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}";

    if (typeof document !== "undefined") {
      var cssId = "dsh-subagent-default-model/client.css";
      if (!document.querySelector("style[data-plugin-css='" + cssId + "']")) {
        var styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-subagent-default-model";
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = SETTINGS_CSS;
        document.head.appendChild(styleTag);
      }
    }

    // ── locale ───────────────────────────────────────────────────────────
    var SUBAGENT_ROW_LOCALE = "settings.subagentModel";
    var SUBAGENT_ROW_ZH = {
      "row.title": "子代理默认模型（dsh-subagent-default-model）",
      "row.desc": "为 subagent / subagent_fork 选择一个或多个默认路由；清空后子代理继承父会话路由。",
      "row.provider": "Provider",
      "row.model": "Model",
      "row.effort": "推理强度",
      "row.add": "添加模型",
      "row.remove": "移除模型",
      "row.strategy": "分配策略",
      "row.roundRobin": "轮换",
      "row.random": "随机",
      "row.inherit": "（继承父会话路由）",
      "row.empty": "尚未指定默认模型，子代理将继承父会话路由。",
      "row.effortDefault": "Default",
      "row.save": "保存",
      "row.saved": "已保存",
      "row.incomplete": "请为每个模型路由选择 Provider 和 Model。",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "子代理默认模型设置已保存。"
    };
    var SUBAGENT_ROW_EN = {
      "row.title": "Subagent default model (dsh-subagent-default-model)",
      "row.desc": "Choose one or more default routes for subagent / subagent_fork; clear them to inherit the parent session route.",
      "row.provider": "Provider",
      "row.model": "Model",
      "row.effort": "Reasoning strength",
      "row.add": "Add model",
      "row.remove": "Remove model",
      "row.strategy": "Distribution",
      "row.roundRobin": "Round-robin",
      "row.random": "Random",
      "row.inherit": "(inherit parent route)",
      "row.effortDefault": "Default",
      "row.empty": "No default model is selected; subagents inherit the parent route.",
      "row.save": "Save",
      "row.saved": "Saved",
      "row.incomplete": "Choose a provider and model for every route.",
      "row.saveFailed": "Could not save the setting. Try again.",
      "row.toastSaved": "Subagent default model settings saved."
    };

    // ── helpers ──────────────────────────────────────────────────────────
    var SUBAGENT_MODEL_SETTINGS_NS = "subagent-default-model";

    function normalizeDefaultModels(value) {
      var result = [];
      if (Array.isArray(value.models) && value.models.length > 0) {
        for (var i = 0; i < value.models.length; i++) {
          var entry = value.models[i];
          if (typeof entry === "string") result.push({ provider: value.provider || "", model: entry, reasoningEffort: "" });
          else if (entry && typeof entry === "object") result.push({ provider: entry.provider || value.provider || "", model: entry.model || "", reasoningEffort: entry.reasoningEffort || "" });
        }
      } else if (value.provider || value.model) {
        result.push({ provider: value.provider || "", model: value.model || "", reasoningEffort: value.reasoningEffort || "" });
      }
      return result;
    }

    function serializeDefaultModels(previousValue, routes, strategy) {
      var next = Object.assign({}, previousValue || {});
      if (routes.length === 0) {
        next.provider = "";
        next.model = "";
        next.models = [];
        next.strategy = "round-robin";
        delete next.reasoningEffort;
        return next;
      }
      var provider = routes[0].provider;
      var sharedEffort = routes[0].reasoningEffort;
      var allSameEffort = routes.every(function (route) { return route.reasoningEffort === sharedEffort; });
      next.provider = provider;
      next.model = "";
      next.models = routes.map(function (route) {
        if (route.provider === provider && !route.reasoningEffort) {
          return route.model;
        }
        var base = { provider: route.provider, model: route.model };
        if (route.reasoningEffort) {
          base.reasoningEffort = route.reasoningEffort;
        }
        return base;
      });
      next.strategy = strategy === "random" ? "random" : "round-robin";
      if (allSameEffort && sharedEffort) {
        next.reasoningEffort = sharedEffort;
      } else {
        delete next.reasoningEffort;
      }
      return next;
    }

    function persistDefaultModels(scope, value) {
      return Promise.resolve().then(function () { return scope.set("provider", value.provider); }).then(function () {
        return scope.set("model", value.model);
      }).then(function () {
        return scope.set("models", value.models);
      }).then(function () {
        return scope.set("strategy", value.strategy);
      }).then(function () {
        return scope.set("reasoningEffort", value.reasoningEffort || "");
      });
    }

    function useSettingsScopeSnapshot(scope) {
      var snapshotState = React.useState(scope.getSnapshot());
      React.useEffect(function () {
        function update() { snapshotState[1](scope.getSnapshot()); }
        return scope.subscribe(update);
      }, [scope]);
      return snapshotState[0];
    }

    // ── SubagentModelRow component ───────────────────────────────────────
    function SubagentModelRow(props) {
      var t = props.t;
      var snap = useSettingsScopeSnapshot(props.settingsScope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      var groupsState = React.useState([]);
      var routesState = React.useState(normalizeDefaultModels(value));
      var strategyState = React.useState(value.strategy === "random" ? "random" : "round-robin");
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      var toastState = React.useState(null);
      var toastSeq = React.useRef(0);
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      React.useEffect(function () {
        var alive = true;
        props.loadCatalog().then(function (groups) {
          if (alive) groupsState[1](groups);
        }).catch(function () {});
        return function () { alive = false; };
      }, []);
      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        routesState[1](normalizeDefaultModels(value));
        strategyState[1](value.strategy === "random" ? "random" : "round-robin");
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);
      function updateRoute(index, field, nextValue) {
        routesState[1](function (routes) {
          return routes.map(function (route, routeIndex) {
            if (routeIndex !== index) return route;
            var next = { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort || "" };
            next[field] = nextValue;
            if (field === "provider") {
              next.model = "";
              next.reasoningEffort = "";
            }
            return next;
          });
        });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function addRoute() {
        var firstGroup = groupsState[0][0];
        routesState[1](function (routes) {
          return routes.concat({ provider: firstGroup ? firstGroup.id : "", model: "", reasoningEffort: "" });
        });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function removeRoute(index) {
        routesState[1](function (routes) { return routes.filter(function (_, routeIndex) { return routeIndex !== index; }); });
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        var nextValue = serializeDefaultModels(value, routesState[0], strategyState[0]);
        savedState[1](false);
        saveErrorState[1](false);
        busyState[1](true);
        Promise.resolve().then(function () {
          return props.write(nextValue);
        }).then(function () {
          var accepted = props.settingsScope.getSnapshot();
          var acceptedValue = (accepted && accepted.status === "ready" && accepted.value) || {};
          if (acceptedValue.provider !== nextValue.provider || acceptedValue.model !== nextValue.model || acceptedValue.strategy !== nextValue.strategy || (acceptedValue.reasoningEffort || "") !== (nextValue.reasoningEffort || "") || JSON.stringify(acceptedValue.models || []) !== JSON.stringify(nextValue.models || [])) {
            throw new Error("settings write was not accepted");
          }
          routesState[1](normalizeDefaultModels(acceptedValue));
          strategyState[1](acceptedValue.strategy === "random" ? "random" : "round-robin");
          dirtyState[1](false);
          busyState[1](false);
          savedState[1](true);
          toastSeq.current = toastSeq.current + 1;
          toastState[1]({ seq: toastSeq.current, text: t("row.toastSaved") });
        }).catch(function () {
          busyState[1](false);
          saveErrorState[1](true);
        });
      }
      var hasIncompleteRoute = routesState[0].some(function (route) { return !route.provider || !route.model; });
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || hasIncompleteRoute;
      var routes = routesState[0].map(function (route, index) {
        var group = null;
        for (var groupIndex = 0; groupIndex < groupsState[0].length; groupIndex++) {
          if (groupsState[0][groupIndex].id === route.provider) { group = groupsState[0][groupIndex]; break; }
        }
        var providerChoices = groupsState[0].slice();
        if (route.provider && !group) providerChoices.unshift({ id: route.provider, name: route.provider });
        var modelChoices = group ? (group.models || []).slice() : [];
        if (route.model && !modelChoices.some(function (candidate) { return candidate.id === route.model; })) {
          modelChoices.unshift({ id: route.model, name: route.model });
        }
        var selectedModel = null;
        for (var modelIndex = 0; modelIndex < modelChoices.length; modelIndex++) {
          if (modelChoices[modelIndex].id === route.model) { selectedModel = modelChoices[modelIndex]; break; }
        }
        var effortChoices = selectedModel && selectedModel.reasoning && Array.isArray(selectedModel.reasoning.efforts) ? selectedModel.reasoning.efforts.slice() : [];
        if (route.reasoningEffort && !effortChoices.some(function (candidate) { return candidate.id === route.reasoningEffort; })) {
          effortChoices.unshift({ id: route.reasoningEffort, name: route.reasoningEffort });
        }
        return React.createElement("div", { className: "dsm-model-settings-route", key: index },
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.provider"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.provider,
              onChange: function (event) { updateRoute(index, "provider", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.inherit")),
              providerChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name + " (" + candidate.id + ")");
              })
            )
          ),
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.model"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.model,
              disabled: !route.provider,
              onChange: function (event) { updateRoute(index, "model", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.inherit")),
              modelChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name || candidate.id);
              })
            )
          ),
          React.createElement("label", { className: "dsm-model-settings-field" },
            t("row.effort"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: route.reasoningEffort || "",
              disabled: !route.model,
              onChange: function (event) { updateRoute(index, "reasoningEffort", event.target.value); }
            },
              React.createElement("option", { value: "" }, t("row.effortDefault")),
              effortChoices.map(function (candidate) {
                return React.createElement("option", { key: candidate.id, value: candidate.id }, candidate.name || candidate.id);
              })
            )
          ),
          React.createElement("button", {
            className: "dsm-model-settings-remove",
            type: "button",
            "aria-label": t("row.remove"),
            title: t("row.remove"),
            onClick: function () { removeRoute(index); }
          }, "\u00d7")
        );
      });
      return React.createElement("section", { className: "dsm-model-settings" },
        React.createElement("div", { className: "dsm-model-settings-head" },
          React.createElement("div", { className: "dsm-model-settings-title" }, t("row.title")),
          React.createElement("div", { className: "dsm-model-settings-desc" }, t("row.desc"))
        ),
        routes.length ? React.createElement("div", { className: "dsm-model-settings-list" }, routes) : React.createElement("div", { className: "dsm-model-settings-hint" }, t("row.empty")),
        React.createElement("div", { className: "dsm-model-settings-options" },
          React.createElement(Button, { type: "button", variant: "outline", size: "sm", onClick: addRoute }, t("row.add")),
          routes.length > 1 ? React.createElement("label", { className: "dsm-model-settings-field dsm-model-settings-strategy" },
            t("row.strategy"),
            React.createElement("select", {
              className: "dsm-model-settings-select",
              value: strategyState[0],
              onChange: function (event) { strategyState[1](event.target.value); savedState[1](false); saveErrorState[1](false); dirtyState[1](true); }
            },
              React.createElement("option", { value: "round-robin" }, t("row.roundRobin")),
              React.createElement("option", { value: "random" }, t("row.random"))
            )
          ) : null
        ),
        hasIncompleteRoute ? React.createElement("div", { className: "dsm-model-settings-hint" }, t("row.incomplete")) : null,
        saveErrorState[0] ? React.createElement("div", { className: "dsm-model-settings-hint", role: "alert" }, t("row.saveFailed")) : null,
        React.createElement("div", { className: "dsm-model-settings-actions" },
          React.createElement(Button, { type: "button", variant: "primary", size: "sm", disabled: saveDisabled, onClick: save }, busyState[0] ? t("row.save") + "\u2026" : (savedState[0] ? t("row.saved") : t("row.save"))),
          savedState[0] ? React.createElement("span", { className: "dsm-model-settings-status" }, t("row.saved")) : null
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }

    // ── SubagentModelCard: collapsible card shell (default collapsed) ─────
    function SubagentModelCard(props) {
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var t = props.t;
      var title = t("row.title");
      var description = t("row.desc");
      return React.createElement("li", { className: "dsm-plugin-card" + (open ? " dsm-plugin-card-open" : "") },
        React.createElement("button", {
          type: "button",
          className: "dsm-plugin-card-header",
          "aria-expanded": open,
          "aria-label": title,
          onClick: function () { setOpen(!open); }
        },
          React.createElement("span", { className: "dsm-plugin-card-head" },
            React.createElement("span", { className: "dsm-plugin-card-title" }, title),
            React.createElement("span", { className: "dsm-plugin-card-description" }, description)
          ),
          React.createElement("span", { className: "dsm-plugin-card-chevron" + (open ? " dsm-plugin-card-chevron-open" : "") }, "\u25be")
        ),
        React.createElement("div", { className: "dsm-plugin-card-body", hidden: !open },
          React.createElement(SubagentModelRow, props)
        )
      );
    }

    // ── apply: inject settings row ───────────────────────────────────────
    var inject = ["sessions", "connection", "slots", "locale", "settingsScope", "remote"];

    function apply(ctx) {
      var api = ctx.connection.api;

      // Register locale for this component
      ctx.locale.register(SUBAGENT_ROW_LOCALE, "zh", SUBAGENT_ROW_ZH);
      ctx.locale.register(SUBAGENT_ROW_LOCALE, "en", SUBAGENT_ROW_EN);

      var subagentScope = ctx.settingsScope.bind({ namespace: SUBAGENT_MODEL_SETTINGS_NS });
      var subagentRowInjected = function () {
        return {
          settingsScope: subagentScope,
          loadCatalog: function () {
            return api.llm.models({}).then(function (r) {
              if (!r.result.ok) throw new Error("llm.models failed: " + r.result.error.code);
              return r.result.value.groups || [];
            });
          },
          write: function (value) {
            return persistDefaultModels(subagentScope, value);
          }
        };
      };

      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "subagent-default-model",
          locale: SUBAGENT_ROW_LOCALE,
          inject: subagentRowInjected
        }, SubagentModelCard);
      });
    }

    return { apply: apply, inject: inject };
  }
});
