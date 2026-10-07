import { orderDelivery } from "../_shared/order-delivery/runtime.ts";
Deno.serve(orderDelivery("email"));
