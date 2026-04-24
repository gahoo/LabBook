export interface ViolationRecord {
  id: number;
  student_id: string;
  student_name: string;
  reservation_id: number;
  status: string;
  violation_type: string;
  violation_time: string;
  remark: string | null;
  booking_code?: string;
  equipment_name?: string;
  duration_minutes?: number;
}

export interface UserPenaltyDetails {
  isPenalized: boolean;
  penaltyMethod: 'NONE' | 'RESTRICTED' | 'REQUIRE_APPROVAL' | 'BAN';
  reason: string;
  restrictions: {
    reduce_days: number;
    min_retain_days: number;
    fee_multiplier: number;
  };
  violation_ids: number[];
  triggered_rules_details: Array<{
    rule_id: number;
    rule_name: string;
    contributing_ids: number[];
  }>;
}

export interface MyViolationsResponse {
  violations: ViolationRecord[];
  userPenaltyDetails: UserPenaltyDetails | null;
}
